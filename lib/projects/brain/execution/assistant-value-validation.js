const EXPERT_WORK_MARKERS = [
  "selecteaz",
  "select",
  "prioritiz",
  "argument",
  "justific",
  "recomand",
  "propun",
  "strateg",
  "canal",
  "analizeaz",
  "identific",
  "sugereaz",
];

const UNKNOWABLE_MARKERS = [
  "greutate",
  "buget",
  "data",
  "oraș",
  "oras",
  "locaț",
  "locat",
  "nivel",
  "disponibil",
  "preferin",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function fieldLooksLikeExpertWork(field) {
  const haystack = normalizeText(`${field?.label || ""} ${field?.placeholder || ""} ${field?.id || ""}`);
  const openText = field?.type === "text" || field?.type === "textarea" || field?.type === "long_text";
  if (!openText) return false;
  return EXPERT_WORK_MARKERS.some((marker) => haystack.includes(marker));
}

function fieldLooksUnknowable(field) {
  const haystack = normalizeText(`${field?.label || ""} ${field?.id || ""}`);
  return UNKNOWABLE_MARKERS.some((marker) => haystack.includes(marker));
}

export function validateAssistantValueContribution(plan, context = {}) {
  const reasons = [];
  let aiContributionScore = 70;
  let userEffortScore = 30;

  if (!plan || typeof plan !== "object") {
    return {
      valid: false,
      aiContributionScore: 0,
      userEffortScore: 100,
      reasons: ["missing_plan"],
    };
  }

  if (plan.mode === "recommendation_selection") {
    const groups = plan.recommendationGroups || [];
    const recommendationCount = groups.reduce(
      (sum, group) => sum + (group.recommendations || []).length,
      0,
    );
    if (recommendationCount < 2) {
      reasons.push("recommendation_selection_needs_items");
      return { valid: false, aiContributionScore: 20, userEffortScore: 80, reasons };
    }
    return { valid: true, aiContributionScore: 90, userEffortScore: 20, reasons: [] };
  }

  if (plan.mode === "structured_form" || plan.mode === "spreadsheet_builder") {
    const fields = plan.requiredInputs || [];
    const expertFields = fields.filter((field) => fieldLooksLikeExpertWork(field));
    const unknowableFields = fields.filter((field) => fieldLooksUnknowable(field));
    const prefilledCount = fields.filter((field) => String(field?.prefilledValue || "").trim()).length;

    if (expertFields.length >= 2 && expertFields.length >= fields.length - unknowableFields.length) {
      reasons.push("user_asked_to_perform_expert_analysis");
      aiContributionScore = 15;
      userEffortScore = 85;
    } else if (expertFields.length > 0) {
      reasons.push("mixed_expert_work_fields");
      aiContributionScore = 45;
      userEffortScore = 65;
    }

    if (fields.length > 0 && prefilledCount === 0 && expertFields.length > 0) {
      reasons.push("no_ai_prefilled_defaults");
      aiContributionScore = Math.min(aiContributionScore, 35);
      userEffortScore = Math.max(userEffortScore, 70);
    }
  }

  if (plan.mode === "guided_questions") {
    const questions = plan.questions || [];
    const expertQuestions = questions.filter((q) => fieldLooksLikeExpertWork({ label: q.prompt, type: "textarea" }));
    if (expertQuestions.length >= 2) {
      reasons.push("guided_questions_transfer_expert_work");
      aiContributionScore = 25;
      userEffortScore = 75;
    }
  }

  const haystack = normalizeText(
    `${context.stepTitle || ""} ${context.stepDescription || ""} ${context.projectGoal || ""}`,
  );
  const isStrategic =
    haystack.includes("marketing") ||
    haystack.includes("promov") ||
    haystack.includes("canal") ||
    (haystack.includes("strategie") && !haystack.includes("buget"));

  if (isStrategic && (plan.mode === "structured_form" || plan.mode === "guided_questions")) {
    reasons.push("strategic_step_should_use_recommendations");
    aiContributionScore = Math.min(aiContributionScore, 30);
    userEffortScore = Math.max(userEffortScore, 75);
  }

  const valid = aiContributionScore >= 60 && userEffortScore <= 70 && reasons.length === 0;
  return {
    valid,
    aiContributionScore,
    userEffortScore,
    reasons,
  };
}

export function repairPlanForAssistantValue(plan, context = {}) {
  const evaluation = validateAssistantValueContribution(plan, context);
  if (evaluation.valid) return plan;

  const haystack = normalizeText(
    `${context.stepTitle || ""} ${context.stepDescription || ""} ${context.projectGoal || ""} ${context.projectName || ""}`,
  );

  if (
    evaluation.reasons.includes("strategic_step_should_use_recommendations") ||
    evaluation.reasons.includes("user_asked_to_perform_expert_analysis")
  ) {
    return buildStrategicRecommendationPlan(context, haystack);
  }

  return plan;
}

function buildStrategicRecommendationPlan(context, haystack) {
  const isIterMarketing =
    haystack.includes("iterai") ||
    haystack.includes("iter ai") ||
    (haystack.includes("promov") && haystack.includes("platform"));

  const digitalGroup = {
    id: "digital_channels",
    title: "Canale digitale recomandate",
    description: "ITER a analizat obiectivul și propune canale potrivite pentru promovare online.",
    recommendations: isIterMarketing
      ? [
          {
            id: "meta_ads",
            title: "Meta Ads",
            explanation: "Acoperire largă în România și testare rapidă de mesaje/creative.",
            advantages: ["Reach mare", "Retargeting", "Testare A/B"],
            tradeoffs: ["Cost pe conversie variabil"],
            recommended: true,
            priority: 2,
            confidence: "high",
          },
          {
            id: "tiktok_ads",
            title: "TikTok Ads",
            explanation: "Potrivit pentru demo-uri scurte problemă/soluție ale produselor AI.",
            advantages: ["Format video nativ", "Viralitate"],
            tradeoffs: ["Necesită creative frecvente"],
            recommended: true,
            priority: 1,
            confidence: "high",
          },
          {
            id: "organic_short",
            title: "TikTok și Instagram Reels organice",
            explanation: "Construiește încredere și dovezi sociale fără cost per afișare.",
            advantages: ["Cost redus", "Autenticitate"],
            tradeoffs: ["Necesită consistență"],
            recommended: true,
            priority: 3,
            confidence: "high",
          },
          {
            id: "google_search",
            title: "Google Search",
            explanation: "Captează utilizatori care caută deja soluții AI sau productivitate.",
            advantages: ["Intenție ridicată"],
            tradeoffs: ["Competiție pe cuvinte cheie"],
            recommended: true,
            priority: 4,
            confidence: "medium",
          },
          {
            id: "email_retarget",
            title: "Email onboarding și retargeting",
            explanation: "Convertește utilizatorii care au arătat interes dar nu au cumpărat.",
            advantages: ["ROI bun", "Personalizare"],
            tradeoffs: ["Necesită listă/tracking"],
            recommended: true,
            priority: 5,
            confidence: "medium",
          },
        ]
      : [
          {
            id: "social_ads",
            title: "Reclame pe rețele sociale",
            explanation: "Potrivite pentru testare rapidă de mesaje către publicul țintă.",
            advantages: ["Reach", "Testare"],
            tradeoffs: ["Cost variabil"],
            recommended: true,
            priority: 1,
            confidence: "medium",
          },
          {
            id: "search_ads",
            title: "Google Search",
            explanation: "Util pentru intenție de cumpărare sau informare activă.",
            advantages: ["Intenție ridicată"],
            tradeoffs: ["Competiție"],
            recommended: true,
            priority: 2,
            confidence: "medium",
          },
        ],
  };

  const offlineGroup = {
    id: "offline_channels",
    title: "Canale offline",
    description: isIterMarketing
      ? "Pentru o platformă digitală, canalele offline au prioritate mai mică. Poți include doar dacă ai evenimente sau parteneriate locale."
      : "Include doar dacă contextul proiectului justifică acțiuni offline.",
    recommendations: isIterMarketing
      ? [
          {
            id: "events",
            title: "Evenimente și conferințe (opțional)",
            explanation: "Utile pentru parteneriate B2B sau demo live, dar cost mai mare.",
            advantages: ["Contact direct"],
            tradeoffs: ["Cost și logistică"],
            recommended: false,
            priority: 6,
            confidence: "low",
          },
        ]
      : [
          {
            id: "local_events",
            title: "Evenimente locale",
            explanation: "Relevante dacă publicul țintă este local și activ offline.",
            advantages: ["Vizibilitate locală"],
            tradeoffs: ["Scalabilitate limitată"],
            recommended: false,
            priority: 3,
            confidence: "low",
          },
        ],
  };

  return {
    mode: "recommendation_selection",
    title: context.stepTitle,
    explanation:
      context.stepDescription ||
      "ITER a pregătit recomandări concrete. Confirmă, ajustează sau adaugă opțiuni proprii.",
    whyThisAction: context.whyItMatters || "Alegerea canalelor potrivite accelerează promovarea.",
    expectedOutcome: context.expectedOutcome,
    userActionType: "select",
    userActionInstruction: "Confirmă recomandările ITER sau ajustează selecția.",
    primaryActionLabel: "Confirmă strategia de canale",
    evaluationStrategy: "none",
    resultFormat: "none",
    outputTypes: ["text"],
    requiredInputs: [],
    questions: [],
    choices: [],
    checklistItems: [],
    recommendationGroups: [digitalGroup, offlineGroup],
    selectionRules: {
      minimumSelections: 1,
      allowCustomOption: true,
      allowReorder: true,
    },
    requireAll: false,
    minimumResponses: 1,
    requiresUserAcceptance: true,
    source: "assistant_value_repair",
  };
}
