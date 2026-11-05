// POST /api/analyze-image — visual identification plus a separate sourced/estimated explanation.
import { askGeminiJSON, hasKey, IMAGE_MODEL, supportsImageInput, VISION_RETRY_POLICY } from "./_lib/gemini.js";
import { buildReferenceAssistedRequest, canSendReferencesToGemini, selectLocalReferenceImages } from "./_lib/heritage-reference.js";
import { getOfficialVisualCandidates, verifyImageEvidence } from "./_lib/history-evidence.js";
import { buildMockExplanation, explanationErrorResponse, generateHistoryExplanation } from "./_lib/history-explanation.js";
import { performance } from "node:perf_hooks";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RESULT_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidateName: { type: "STRING" },
    objectType: { type: "STRING" },
    subjectLevel: { type: "STRING", enum: ["place", "facility", "feature", "general", "unknown"] },
    visualFeatures: { type: "ARRAY", items: { type: "STRING" } },
    identificationStatus: { type: "STRING", enum: ["identified", "uncertain", "unknown"] },
    reason: { type: "STRING" },
  },
  required: ["candidateName", "objectType", "visualFeatures", "identificationStatus", "reason"],
};

function fail(status, code, error) { return Object.assign(new Error(error), { status, code }); }

function validateImage(mimeType, encoded) {
  if (!MIME_TYPES.has(mimeType)) throw fail(415, "unsupported_image_type", "Only JPEG, PNG, and WEBP images are supported.");
  if (typeof encoded !== "string" || !encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw fail(400, "invalid_image_data", "A valid base64 image is required.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw fail(400, "invalid_image_data", "A valid base64 image is required.");
  if (bytes.length > MAX_IMAGE_BYTES) throw fail(413, "image_too_large", "The processed image must be 3 MB or smaller.");
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!(mimeType === "image/jpeg" && isJpeg) && !(mimeType === "image/png" && isPng) && !(mimeType === "image/webp" && isWebp)) {
    throw fail(415, "image_signature_mismatch", "The image content does not match its declared format.");
  }
  return bytes;
}

function normalizeResult(value) {
  const statuses = new Set(["identified", "uncertain", "unknown"]);
  if (!value || typeof value !== "object" || !statuses.has(value.identificationStatus) ||
      typeof value.candidateName !== "string" || typeof value.objectType !== "string" ||
      !Array.isArray(value.visualFeatures) || typeof value.reason !== "string") {
    throw fail(502, "invalid_model_response", "The image analysis response was not in the expected format.");
  }
  return {
    candidateName: value.candidateName.slice(0, 160),
    objectType: value.objectType.slice(0, 100),
    ...(["place", "facility", "feature", "general", "unknown"].includes(value.subjectLevel) ? { subjectLevel: value.subjectLevel } : {}),
    visualFeatures: value.visualFeatures.filter((item) => typeof item === "string").slice(0, 8).map((item) => item.slice(0, 180)),
    identificationStatus: value.identificationStatus,
    reason: value.reason.slice(0, 500),
  };
}

async function withExplanation(vision, evidence, lang, { testData = false } = {}) {
  if (testData) return { explanation: buildMockExplanation({ lang, visualFeatures: vision.visualFeatures }), explanationError: null };
  const startedAt = performance.now();
  try {
    const explanation = await generateHistoryExplanation({ ...vision, evidence, lang });
    console.info(`[api/analyze-image] phase=history_explanation outcome=success elapsed_ms=${Math.round(performance.now() - startedAt)}`);
    return { explanation, explanationError: null };
  } catch (error) {
    const explanationError = explanationErrorResponse(error, lang);
    console.warn(`[api/analyze-image] phase=history_explanation outcome=failed code=${explanationError.code} elapsed_ms=${Math.round(performance.now() - startedAt)}`);
    return { explanation: null, explanationError };
  }
}

export default async function analyzeImage(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed", error: "POST only" });
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ code: "invalid_json", error: "Request body must be valid JSON." });
  }

  try {
    const { spotId, spotName, lang = "ko", mimeType, imageBase64 } = body;
    const deferExplanation = body.explanationMode === "deferred";
    if (typeof spotId !== "string" || spotId.length > 100 || typeof spotName !== "string" || !spotName.trim() || spotName.length > 160 || !["ko", "en"].includes(lang)) {
      throw fail(400, "invalid_request", "Place ID, place name, and supported language are required.");
    }
    const imageBytes = validateImage(mimeType, imageBase64);

    // The image mock is independent from GEMINI_MOCK used by existing text features.
    if (process.env.GEMINI_IMAGE_MOCK === "1") {
      const mockResult = {
        candidateName: lang === "ko" ? "테스트용 시각 대상" : "Test visual object",
        objectType: lang === "ko" ? "테스트 데이터" : "Test data",
        visualFeatures: [lang === "ko" ? "테스트 데이터: 실제 사진 분석 결과가 아닙니다." : "Test data: this is not a real photo analysis."],
        identificationStatus: "uncertain",
        reason: lang === "ko" ? "개발 화면 확인용 테스트 데이터입니다." : "Development-only test data for checking the UI.",
      };
      const evidence = await verifyImageEvidence({ spotId, ...mockResult, lang });
      const { explanation, explanationError } = await withExplanation(mockResult, evidence, lang, { testData: true });
      return res.status(200).json({
        ...mockResult, evidence, explanation, explanationError, source: "mock", testData: true, model: "mock",
      });
    }
    if (!hasKey()) throw fail(503, "gemini_not_configured", "AI image analysis is being prepared. Please configure GEMINI_API_KEY on the server.");

    const model = IMAGE_MODEL();
    if (!supportsImageInput(model)) throw fail(503, "unsupported_image_model", `Configured image model '${model}' is not verified as supporting image input. Set GEMINI_IMAGE_MODEL to a supported model.`);
    const visualCandidates = await getOfficialVisualCandidates(spotId);
    const system = `Identify the main subject visibly centered or most prominent in the supplied image. Distinguish a whole heritage place from an individual facility (such as a hall or gate) and from a smaller architectural feature. Use a specific facility name only when the image itself provides enough visible evidence; otherwise use a broad object category or the place level. The place context and the supplied candidate vocabulary are weak hints, never proof; candidates may be absent from the photo. Do not force a match. Do not infer or invent construction dates, people, historical events, or other historical facts. If uncertain, use identificationStatus "uncertain"; if no defensible candidate can be named, use "unknown". Set subjectLevel to place, facility, feature, general, or unknown according to the specificity of the visual candidate. Return ${lang === "ko" ? "Korean" : "English"}. In English, use these consistent names when relevant: Simujang, Jeongneung Royal Tomb, Uireung Royal Tomb, Jeongjagak, Hongsalmun, and Queen Sindeok.`;
    const user = `Possible location context (weak hint only): ${spotName} (place ID: ${spotId}). Possible names of facilities recorded for this place (suggestions only; do not assume any is visible): ${JSON.stringify(visualCandidates)}. Identify the most prominent visible subject and list concrete visual clues supporting the candidate. Do not claim historical facts that cannot be seen in the photo.`;
    const visionStartedAt = performance.now();
    let baselineRaw;
    try {
      baselineRaw = await askGeminiJSON({
        system, user, schema: RESULT_SCHEMA,
        // Only a 503 gets one retry; each 21s attempt plus 1.5s backoff fits the 45s budget.
        // The legacy combined response keeps its existing 12s per-attempt limit.
        model,
        timeoutMs: deferExplanation ? VISION_RETRY_POLICY.attemptTimeoutMs : 12000,
        maxAttempts: deferExplanation ? VISION_RETRY_POLICY.maxAttempts : 2,
        retryStatuses: [503],
        retryDelayMs: deferExplanation ? VISION_RETRY_POLICY.retryDelayMs : 1200,
        phase: "vision",
        image: { mimeType, data: imageBytes.toString("base64") },
      });
      console.info(`[api/analyze-image] phase=vision outcome=success elapsed_ms=${Math.round(performance.now() - visionStartedAt)}`);
    } catch (error) {
      console.warn(`[api/analyze-image] phase=vision outcome=failed code=${error.code || "unknown"} upstream_status=${error.geminiStatus || "none"} elapsed_ms=${Math.round(performance.now() - visionStartedAt)}`);
      throw error;
    }
    const baseline = normalizeResult(baselineRaw);

    // References are an opt-in secondary pass. Until rights are explicitly confirmed,
    // they may be selected/read locally but must never be sent to Gemini.
    if (!deferExplanation && process.env.GEMINI_IMAGE_REFERENCE_MODE === "1") {
      try {
        const references = await selectLocalReferenceImages({ spotId, candidateName: baseline.candidateName, objectType: baseline.objectType });
        if (references.length >= 2 && await canSendReferencesToGemini()) {
          const assisted = buildReferenceAssistedRequest({
            spotId, spotName, lang, baseline,
            userImage: { mimeType, data: imageBytes.toString("base64") },
            references,
          });
          const assistedRaw = await askGeminiJSON({
            system: assisted.system, user: assisted.user, schema: RESULT_SCHEMA, model, timeoutMs: 12000,
            phase: "vision_reference",
            images: assisted.images,
          });
          const assistedResult = normalizeResult(assistedRaw);
          const evidence = await verifyImageEvidence({ spotId, ...assistedResult, lang });
          const explanationResult = await withExplanation(assistedResult, evidence, lang);
          return res.status(200).json({ ...assistedResult, evidence, ...explanationResult, source: "gemini", testData: false, model });
        }
      } catch (referenceError) {
        // A missing/corrupt optional dataset or failed auxiliary pass falls back to baseline.
        console.warn("[api/analyze-image] reference assist unavailable; returning baseline result");
      }
    }
    const evidence = await verifyImageEvidence({ spotId, ...baseline, lang });
    if (deferExplanation) {
      return res.status(200).json({
        ...baseline, evidence, explanation: null, explanationError: null,
        explanationPending: true, source: "gemini", testData: false, model,
      });
    }
    const explanationResult = await withExplanation(baseline, evidence, lang);
    return res.status(200).json({ ...baseline, evidence, ...explanationResult, source: "gemini", testData: false, model });
  } catch (error) {
    if (error.code === "gemini_timeout" || error.name === "AbortError") {
      const limitSeconds = error.phase === "vision" && body?.explanationMode === "deferred" ? 45 : 12;
      return res.status(504).json({ code: "gemini_timeout", error: `Gemini did not respond within the configured ${limitSeconds}-second request limit.` });
    }
    if (error.code === "gemini_dns_error" || error.code === "gemini_network_error") {
      return res.status(502).json({ code: error.code, error: "The Gemini API could not be reached from the server. Check DNS and outbound network access." });
    }
    const upstreamStatus = error.geminiStatus;
    if (upstreamStatus === 503) return res.status(503).json({ code: "gemini_service_unavailable", error: "Gemini is temporarily unavailable (HTTP 503). Try again later." });
    if (upstreamStatus === 429) return res.status(429).json({ code: "gemini_rate_limited", error: "Gemini is temporarily rate limited. Please try again shortly." });
    if (upstreamStatus === 401 || upstreamStatus === 403) return res.status(502).json({ code: "gemini_auth_error", error: "Gemini rejected the server credentials or API permissions." });
    const status = error.status || 502;
    const code = error.code || (status === 502 ? "gemini_error" : "request_failed");
    const message = status === 502 ? "Image analysis failed. Please try again." : error.message;
    if (status >= 500) console.error(`[api/analyze-image] outcome=failed code=${code} upstream_status=${upstreamStatus || "none"}`);
    return res.status(status).json({ code, error: message });
  }
}

export const config = { maxDuration: 60 };
