// POST /api/generate-image-explanation — second-stage explanation without resending the photo.
import { hasKey } from "./_lib/gemini.js";
import { buildHistoryVerification, verifyImageEvidence } from "./_lib/history-evidence.js";
import { buildFallbackExplanation, buildMockExplanation, explanationErrorResponse, generateHistoryExplanation, getDestinationStoryEvidence, classifyExplanationType } from "./_lib/history-explanation.js";

const SPOT_IDS = new Set(["simujang", "jeongneung", "uiryeong"]);
function fail(status, code, error) { return Object.assign(new Error(error), { status, code }); }

function validate(body) {
  const { spotId, lang, vision } = body;
  if (!SPOT_IDS.has(spotId) || !["ko", "en"].includes(lang) || !vision || typeof vision !== "object" ||
      typeof vision.candidateName !== "string" || vision.candidateName.length > 160 ||
      typeof vision.objectType !== "string" || vision.objectType.length > 100 ||
      (vision.subjectLevel !== undefined && !["place", "facility", "feature", "general", "unknown"].includes(vision.subjectLevel)) ||
      typeof vision.reason !== "string" || vision.reason.length > 500 ||
      !Array.isArray(vision.visualFeatures) || vision.visualFeatures.length > 8 ||
      !vision.visualFeatures.every((item) => typeof item === "string" && item.length <= 180) ||
      !["identified", "uncertain", "unknown"].includes(vision.identificationStatus) ||
      (vision.heritageRelevance !== undefined && !["relevant", "irrelevant", "uncertain"].includes(vision.heritageRelevance))) {
    throw fail(400, "invalid_request", "A valid place, language, and saved image analysis are required.");
  }
  return { spotId, lang, vision };
}

export default async function generateImageExplanation(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed", error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { spotId, lang, vision } = validate(body);
    if (body.testData === true && process.env.GEMINI_IMAGE_MOCK === "1") {
      const evidence = await verifyImageEvidence({ spotId, ...vision, lang });
      const explanation = buildMockExplanation({ lang, visualFeatures: vision.visualFeatures });
      return res.status(200).json({ explanation, explanationError: null, evidence,
        historyVerification: buildHistoryVerification({ evidence, identificationStatus: vision.identificationStatus, explanation }), testData: true });
    }
    if (vision.heritageRelevance === "irrelevant") return res.status(200).json({ explanation: null, explanationError: null, skipped: "unrelated_photo", testData: false });
    if (!hasKey()) throw fail(503, "gemini_not_configured", "AI explanation is not configured on the server.");

    const evidence = await verifyImageEvidence({ spotId, ...vision, lang });
    let storyEvidence = evidence;
    let storyVision = vision;
    if (vision.heritageRelevance !== "irrelevant" && evidence?.evidenceStatus !== "conflicting" && ["place", "general", "unknown"].includes(vision.subjectLevel || "unknown") && classifyExplanationType({ evidence, identificationStatus: vision.identificationStatus }) !== "grounded") {
      const destination = await getDestinationStoryEvidence(spotId, lang);
      if (destination) {
        storyEvidence = destination.evidence;
        storyVision = { ...vision, candidateName: destination.destinationName, objectType: "heritage destination", identificationStatus: "uncertain", visualFeatures: [] };
      }
    }
    try {
      const explanation = await generateHistoryExplanation({ ...storyVision, evidence: storyEvidence, lang });
      return res.status(200).json({ explanation, explanationError: null, evidence,
        historyVerification: buildHistoryVerification({ evidence, identificationStatus: vision.identificationStatus, explanation }), testData: false });
    } catch (error) {
      return res.status(200).json({ explanation: buildFallbackExplanation({ evidence: storyEvidence, visualFeatures: storyVision.visualFeatures, identificationStatus: storyVision.identificationStatus, lang }), explanationError: explanationErrorResponse(error, lang), evidence,
        historyVerification: buildHistoryVerification({ evidence, identificationStatus: vision.identificationStatus }), testData: false });
    }
  } catch (error) {
    const status = error.status || (error.code === "gemini_timeout" ? 504 : error.geminiStatus === 429 ? 429 : 502);
    const code = error.code || (error.geminiStatus === 429 ? "gemini_rate_limited" : "explanation_failed");
    const message = error.geminiStatus === 429 ? "Gemini is temporarily rate limited. Please try again shortly." :
      status === 502 ? "The explanation could not be generated. Please try again." : error.message;
    return res.status(status).json({ code, error: message });
  }
}

export const config = { maxDuration: 60 };
