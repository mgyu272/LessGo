// Re-localize saved Vision output after the app language changes; this route never receives an image.
import { hasKey, MODEL, askGeminiJSON } from "./_lib/gemini.js";
import { verifyImageEvidence } from "./_lib/history-evidence.js";
import { buildMockExplanation, explanationErrorResponse, generateHistoryExplanation } from "./_lib/history-explanation.js";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    candidateName: { type: "STRING" },
    objectType: { type: "STRING" },
    subjectLevel: { type: "STRING", enum: ["place", "facility", "feature", "general", "unknown"] },
    visualFeatures: { type: "ARRAY", items: { type: "STRING" } },
    reason: { type: "STRING" },
  },
  required: ["candidateName", "objectType", "visualFeatures", "reason"],
};

const NAME_GUIDE = {
  심우장: "Simujang",
  정릉: "Jeongneung Royal Tomb",
  의릉: "Uireung Royal Tomb",
  신덕왕후: "Queen Sindeok",
  정자각: "Jeongjagak",
  홍살문: "Hongsalmun",
  비각: "stele pavilion",
  재실: "ritual preparation building",
  석물: "stone sculptures",
  "정릉 석물": "Jeongneung tomb sculptures",
  "의릉 석물": "Uireung tomb sculptures",
  "의릉 재실": "Uireung Jaesil",
  "의릉 재실 터": "Uireung Jaesil",
};

function fail(status, code, error) { return Object.assign(new Error(error), { status, code }); }

function validate(body) {
  const { spotId, lang, vision } = body;
  if (![
    "simujang", "jeongneung", "uiryeong",
  ].includes(spotId) || !["ko", "en"].includes(lang) || !vision || typeof vision !== "object" ||
      typeof vision.candidateName !== "string" || vision.candidateName.length > 160 ||
      typeof vision.objectType !== "string" || vision.objectType.length > 100 ||
      (vision.subjectLevel !== undefined && !["place", "facility", "feature", "general", "unknown"].includes(vision.subjectLevel)) ||
      typeof vision.reason !== "string" || vision.reason.length > 500 ||
      !Array.isArray(vision.visualFeatures) || vision.visualFeatures.length > 8 ||
      !vision.visualFeatures.every((item) => typeof item === "string" && item.length <= 180) ||
      !["identified", "uncertain", "unknown"].includes(vision.identificationStatus)) {
    throw fail(400, "invalid_request", "A valid place, language, and saved image analysis are required.");
  }
  return { spotId, lang, vision };
}

async function localizeVision(vision, lang) {
  const language = lang === "ko" ? "Korean" : "English";
  const response = await askGeminiJSON({
    system: `Translate the supplied saved visual-analysis fields into ${language}. This is translation only: do not inspect an image, add observations, infer historical facts, or change the identification status. Preserve all meaning and uncertainty. Translate objectType as a short category label (for example, building, gate, stone sculpture), not a descriptive sentence. Use the supplied established heritage-name glossary when it exactly applies; do not force a glossary entry onto a different name. If the candidate is unknown, keep it as a localized unknown label. Return only the requested JSON fields.`,
    user: JSON.stringify({ targetLanguage: language, establishedNameGlossary: NAME_GUIDE, savedVisionFields: {
      candidateName: vision.candidateName,
      objectType: vision.objectType,
      ...(vision.subjectLevel ? { subjectLevel: vision.subjectLevel } : {}),
      visualFeatures: vision.visualFeatures,
      reason: vision.reason,
      identificationStatus: vision.identificationStatus,
    } }),
    schema: SCHEMA,
    model: MODEL(),
    timeoutMs: 10000,
    temperature: 0.1,
  });
  if (!response || typeof response.candidateName !== "string" || typeof response.objectType !== "string" ||
      !Array.isArray(response.visualFeatures) || !response.visualFeatures.every((item) => typeof item === "string") ||
      typeof response.reason !== "string") throw fail(502, "invalid_localization_response", "The localized analysis response was invalid.");
  return {
    candidateName: response.candidateName.slice(0, 160),
    objectType: response.objectType.slice(0, 100),
    ...(vision.subjectLevel ? { subjectLevel: vision.subjectLevel } : {}),
    visualFeatures: response.visualFeatures.slice(0, 8).map((item) => item.slice(0, 180)),
    reason: response.reason.slice(0, 500),
    identificationStatus: vision.identificationStatus,
  };
}

export default async function localizeImageAnalysis(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed", error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { spotId, lang, vision } = validate(body);
    const mock = body.testData === true && process.env.GEMINI_IMAGE_MOCK === "1";
    if (!mock && !hasKey()) throw fail(503, "gemini_not_configured", "Language update is unavailable until the server API key is configured.");

    const localizedVision = mock
      ? { candidateName: lang === "ko" ? "테스트용 시각 대상" : "Test visual object", objectType: lang === "ko" ? "테스트 데이터" : "Test data", visualFeatures: [lang === "ko" ? "테스트 데이터: 실제 사진 분석 결과가 아닙니다." : "Test data: this is not a real photo analysis."], reason: lang === "ko" ? "개발 화면 확인용 테스트 데이터입니다." : "Development-only test data for checking the UI.", identificationStatus: "uncertain" }
      : await localizeVision(vision, lang);
    const evidence = await verifyImageEvidence({ spotId, ...localizedVision, lang });
    if (mock) return res.status(200).json({ ...localizedVision, evidence, explanation: buildMockExplanation({ lang, visualFeatures: localizedVision.visualFeatures }), explanationError: null, source: "mock", testData: true });

    try {
      const explanation = await generateHistoryExplanation({ ...localizedVision, evidence, lang });
      return res.status(200).json({ ...localizedVision, evidence, explanation, explanationError: null, source: "gemini", testData: false });
    } catch (error) {
      return res.status(200).json({ ...localizedVision, evidence, explanation: null, explanationError: explanationErrorResponse(error, lang), source: "gemini", testData: false });
    }
  } catch (error) {
    const status = error.status || (error.name === "AbortError" ? 504 : error.geminiStatus === 429 ? 429 : 502);
    const code = error.code || (error.name === "AbortError" ? "gemini_timeout" : error.geminiStatus === 429 ? "gemini_rate_limited" : "localization_failed");
    const message = error.geminiStatus === 429 ? "Gemini is temporarily rate limited. Please try again shortly." :
      status === 502 ? "The saved analysis could not be translated. Please try again." : error.message;
    return res.status(status).json({ code, error: message });
  }
}
