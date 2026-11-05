import assert from "node:assert/strict";
import { verifyImageEvidence } from "../api/_lib/history-evidence.js";
import analyzeImage from "../api/analyze-image.js";
import localizeImageAnalysis from "../api/localize-image-analysis.js";

const cases = [
  { label: "simujang supported", input: { spotId: "simujang", candidateName: "심우장", objectType: "한옥", visualFeatures: ["한옥 지붕"], identificationStatus: "identified", lang: "ko" }, status: "supported" },
  { label: "simujang insufficient", input: { spotId: "simujang", candidateName: "주방", objectType: "건물", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "insufficient" },
  { label: "simujang conflicting", input: { spotId: "simujang", candidateName: "정릉", objectType: "왕릉", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "conflicting" },
  { label: "jeongneung supported", input: { spotId: "jeongneung", candidateName: "Queen Sindeok", objectType: "queen", visualFeatures: ["stone mound"], identificationStatus: "identified", lang: "ko" }, status: "supported" },
  { label: "jeongneung official facility", input: { spotId: "jeongneung", candidateName: "정자각", objectType: "건축물", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "supported", sourceLevel: "official" },
  { label: "jeongneung insufficient", input: { spotId: "jeongneung", candidateName: "수라간", objectType: "건축물", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "insufficient" },
  { label: "jeongneung conflicting", input: { spotId: "jeongneung", candidateName: "의릉", objectType: "왕릉", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "conflicting" },
  { label: "uiryeong supported", input: { spotId: "uiryeong", candidateName: "stone tiger", objectType: "stone statue", visualFeatures: ["animal-shaped stone"], identificationStatus: "uncertain", lang: "en" }, status: "supported" },
  { label: "uiryeong insufficient", input: { spotId: "uiryeong", candidateName: "수라간", objectType: "gate", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "insufficient" },
  { label: "uiryeong conflicting", input: { spotId: "uiryeong", candidateName: "심우장", objectType: "한옥", visualFeatures: [], identificationStatus: "identified", lang: "ko" }, status: "conflicting" },
];

for (const item of cases) {
  const evidence = await verifyImageEvidence(item.input);
  assert.equal(evidence.evidenceStatus, item.status, item.label);
  if (item.sourceLevel) assert.equal(evidence.sourceLevel, item.sourceLevel, item.label);
  assert.ok(["supported", "insufficient", "conflicting"].includes(evidence.evidenceStatus));
  assert.ok(Array.isArray(evidence.supportedFacts));
  assert.ok(Array.isArray(evidence.sources));
  assert.ok(Array.isArray(evidence.limitations));
  if (item.status !== "supported") assert.equal(evidence.supportedFacts.length, 0, `${item.label} must not emit facts`);
  if (item.status === "supported") assert.ok(evidence.supportedFacts.length > 0, `${item.label} should include source-text facts`);
}

const sourceStatus = await verifyImageEvidence(cases[0].input);
assert.equal(sourceStatus.sourceLevel, "official");
assert.ok(sourceStatus.sources.every((source) => source.url?.startsWith("https://")));
assert.ok(sourceStatus.limitations.some((item) => item.includes("사진 속 대상이 그 시설이라고 확정하지는 않습니다")));
const internalStatus = await verifyImageEvidence(cases[3].input);
assert.equal(internalStatus.evidenceStatus, "supported");
assert.equal(internalStatus.sourceLevel, "internal");
assert.ok(internalStatus.limitations.some((item) => item.includes("공식 출처 URL")));
const spotScopedJeongjagak = await verifyImageEvidence({ ...cases.find((item) => item.label === "jeongneung official facility").input, spotId: "uiryeong" });
assert.equal(spotScopedJeongjagak.evidenceStatus, "supported");
assert.equal(spotScopedJeongjagak.sourceLevel, "official");
assert.equal(spotScopedJeongjagak.matchedObjectName, "정자각");
const uncertainVision = await verifyImageEvidence(cases.find((item) => item.label === "uiryeong supported").input);
assert.ok(uncertainVision.limitations.some((item) => item.includes("uncertain")));
const unknownVision = await verifyImageEvidence({ ...cases[0].input, identificationStatus: "unknown" });
assert.equal(unknownVision.evidenceStatus, "insufficient");
assert.deepEqual(unknownVision.supportedFacts, []);

// Exercise the existing analysis route with a local stub only; no Gemini network request is made.
const previousFetch = globalThis.fetch;
const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_IMAGE_MOCK: process.env.GEMINI_IMAGE_MOCK,
  GEMINI_IMAGE_REFERENCE_MODE: process.env.GEMINI_IMAGE_REFERENCE_MODE,
  GEMINI_IMAGE_REFERENCE_EXTERNAL_OK: process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK,
};
let upstreamCalls = 0;
globalThis.fetch = async (_url, init) => {
  upstreamCalls++;
  const vision = { candidateName: "심우장", objectType: "한옥", subjectLevel: "place", visualFeatures: ["한옥 지붕"], identificationStatus: "identified", reason: "Mock vision response." };
  const response = upstreamCalls === 1 ? vision : { title: "공식 자료로 보는 심우장", text: "국가유산포털은 심우장을 1933년의 생활유적으로 기록합니다. 한용운 생애 자료는 집의 방향에 관한 일화를 전합니다.", aiContext: ["전통 가옥은 지붕과 마당의 구성을 함께 살펴볼 수 있습니다."] };
  if (upstreamCalls === 1) {
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    assert.match(prompt, /Possible names of facilities recorded for this place/u);
  }
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) };
};
try {
  process.env.GEMINI_API_KEY = "offline-test-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_IMAGE_REFERENCE_MODE = "0";
  process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = "0";
  delete process.env.GEMINI_IMAGE_MOCK;
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  await analyzeImage({ method: "POST", body: { spotId: "simujang", spotName: "심우장", lang: "ko", mimeType: "image/png", imageBase64: image } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(upstreamCalls, 2);
  for (const key of ["candidateName", "objectType", "visualFeatures", "identificationStatus", "reason", "evidence", "explanation", "explanationError", "source", "testData", "model"]) {
    assert.ok(Object.hasOwn(response.body, key), `API response is missing '${key}'`);
  }
  assert.equal(response.body.evidence.evidenceStatus, "supported");
  assert.equal(response.body.explanation.type, "grounded");
  assert.equal(response.body.subjectLevel, "place");
  assert.equal(response.body.explanation.aiContext.length, 1);
  assert.equal(response.body.explanation.aiContextVerification, "unverified_general_ai_context");
  assert.equal(response.body.explanation.sources.length, 2);
  assert.equal(response.body.explanationError, null);

  // A failure during the separate explanation pass leaves the original vision and evidence intact.
  const failedExplanationResponse = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    if (upstreamCalls === 1) {
      const vision = { candidateName: "정자각", objectType: "건축물", visualFeatures: ["기와지붕"], identificationStatus: "identified", reason: "Visible roof and hall structure." };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(vision) }] } }] }) };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };
  await analyzeImage({ method: "POST", body: { spotId: "jeongneung", spotName: "정릉", lang: "ko", mimeType: "image/png", imageBase64: image } }, failedExplanationResponse);
  assert.equal(failedExplanationResponse.statusCode, 200);
  assert.equal(failedExplanationResponse.body.identificationStatus, "identified");
  assert.equal(failedExplanationResponse.body.evidence.sourceLevel, "official");
  assert.equal(failedExplanationResponse.body.explanation, null);
  assert.equal(failedExplanationResponse.body.explanationError.code, "explanation_failed");
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Explicit image mock works without a key and its explanation is labeled as test data.
const beforeMockFetch = globalThis.fetch;
const previousMockKey = process.env.GEMINI_API_KEY;
const previousImageMock = process.env.GEMINI_IMAGE_MOCK;
let mockNetworkCalls = 0;
globalThis.fetch = async () => { mockNetworkCalls++; throw new Error("mock mode must not call Gemini"); };
delete process.env.GEMINI_API_KEY;
process.env.GEMINI_IMAGE_MOCK = "1";
try {
  const mockResponse = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  await analyzeImage({ method: "POST", body: { spotId: "simujang", spotName: "심우장", lang: "ko", mimeType: "image/png", imageBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") } }, mockResponse);
  assert.equal(mockResponse.statusCode, 200);
  assert.equal(mockResponse.body.explanation.testData, true);
  assert.match(mockResponse.body.explanation.disclaimer, /테스트 데이터/u);
  assert.equal(mockNetworkCalls, 0);
} finally {
  globalThis.fetch = beforeMockFetch;
  if (previousMockKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousMockKey;
  if (previousImageMock === undefined) delete process.env.GEMINI_IMAGE_MOCK;
  else process.env.GEMINI_IMAGE_MOCK = previousImageMock;
}

console.log(`Evidence/API tests passed: ${cases.length} place cases + official/internal source levels + spot-scoped shared names + explanation error isolation + explicit image mock (external requests: 0).`);

// Language switching reuses the saved vision fields through the text-only localization route.
const oldLocalizationEnv = { key: process.env.GEMINI_API_KEY, mock: process.env.GEMINI_IMAGE_MOCK };
const previousLocalizationFetch = globalThis.fetch;
let localizationCalls = 0;
globalThis.fetch = async (_url, init) => {
  localizationCalls++;
  const request = JSON.parse(init.body);
  const prompt = request.contents[0].parts[0].text;
  if (localizationCalls === 1) {
    assert.match(prompt, /savedVisionFields/u);
    assert.match(prompt, /establishedNameGlossary/u);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ candidateName: "Jeongjagak", objectType: "building", visualFeatures: ["tiled roof"], reason: "A traditional roof and open hall are visible." }) }] } }] }) };
  }
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "A ritual space", text: "Official records describe Jeongjagak as a building for royal tomb rites. Its records help visitors understand the ritual spaces of a royal tomb." }) }] } }] }) };
};
try {
  process.env.GEMINI_API_KEY = "offline-localization-test-key";
  delete process.env.GEMINI_IMAGE_MOCK;
  const localizedResponse = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  await localizeImageAnalysis({ method: "POST", body: { spotId: "jeongneung", lang: "en", vision: { candidateName: "정자각", objectType: "건축물", subjectLevel: "facility", visualFeatures: ["기와지붕"], identificationStatus: "identified", reason: "지붕과 열린 건물 구조가 보입니다." } } }, localizedResponse);
  assert.equal(localizedResponse.statusCode, 200);
  assert.equal(localizedResponse.body.candidateName, "Jeongjagak");
  assert.equal(localizedResponse.body.subjectLevel, "facility", "recognition specificity is preserved when changing language");
  assert.equal(localizedResponse.body.evidence.factSources.some((entry) => entry.fact.includes("royal tomb")), true);
  assert.ok(localizedResponse.body.evidence.sources.every((source) => source.titleEn && /[A-Za-z]/u.test(source.title)));
  assert.ok(localizedResponse.body.evidence.limitations.every((line) => !/[가-힣]/u.test(line)), "English verification limitations are localized");
  assert.equal(localizedResponse.body.explanation.language, "en");
  assert.equal(localizationCalls, 2, "localization plus explanation use saved text and never submit an image");
} finally {
  globalThis.fetch = previousLocalizationFetch;
  if (oldLocalizationEnv.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldLocalizationEnv.key;
  if (oldLocalizationEnv.mock === undefined) delete process.env.GEMINI_IMAGE_MOCK; else process.env.GEMINI_IMAGE_MOCK = oldLocalizationEnv.mock;
}

// The reverse switch also regenerates localized facts from the saved vision fields.
let koreanCall = 0;
const previousKoreanLocalizationKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "offline-korean-localization-test-key";
globalThis.fetch = async (_url, init) => {
  koreanCall++;
  const response = koreanCall === 1
    ? { candidateName: "정자각", objectType: "건축물", visualFeatures: ["기와지붕"], reason: "기와지붕과 열린 건물 구조가 보입니다." }
    : { title: "왕릉의 제례 공간", text: "정자각은 왕릉 제향을 위한 건물입니다. 정릉의 자료는 이 시설의 위치와 복구 기록을 전합니다." };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) };
};
try {
  const koResponse = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  await localizeImageAnalysis({ method: "POST", body: { spotId: "jeongneung", lang: "ko", vision: { candidateName: "Jeongjagak", objectType: "building", visualFeatures: ["tiled roof"], identificationStatus: "identified", reason: "A traditional roof is visible." } } }, koResponse);
  assert.equal(koResponse.statusCode, 200);
  assert.equal(koResponse.body.evidence.factSources.some((entry) => entry.fact.includes("왕릉 제향")), true);
  assert.equal(koResponse.body.explanation.language, "ko");
} finally {
  globalThis.fetch = previousLocalizationFetch;
  if (previousKoreanLocalizationKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKoreanLocalizationKey;
}

const noKeyEnv = { key: process.env.GEMINI_API_KEY, mock: process.env.GEMINI_IMAGE_MOCK };
delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_IMAGE_MOCK;
const noKeyLocalization = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
await localizeImageAnalysis({ method: "POST", body: { spotId: "jeongneung", lang: "en", vision: { candidateName: "정자각", objectType: "건축물", visualFeatures: [], identificationStatus: "identified", reason: "지붕이 보입니다." } } }, noKeyLocalization);
assert.equal(noKeyLocalization.statusCode, 503);
assert.equal(noKeyLocalization.body.code, "gemini_not_configured");
process.env.GEMINI_IMAGE_MOCK = "1";
let localizedMockNetworkCalls = 0;
globalThis.fetch = async () => { localizedMockNetworkCalls++; throw new Error("explicit localization mock must not call Gemini"); };
const localizedMock = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
await localizeImageAnalysis({ method: "POST", body: { spotId: "jeongneung", lang: "en", testData: true, vision: { candidateName: "테스트용 시각 대상", objectType: "테스트 데이터", visualFeatures: ["테스트 데이터"], identificationStatus: "uncertain", reason: "테스트 데이터" } } }, localizedMock);
assert.equal(localizedMock.statusCode, 200);
assert.equal(localizedMock.body.testData, true);
assert.match(localizedMock.body.explanation.disclaimer, /Test data/u);
assert.equal(localizedMockNetworkCalls, 0);
if (noKeyEnv.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = noKeyEnv.key;
if (noKeyEnv.mock === undefined) delete process.env.GEMINI_IMAGE_MOCK; else process.env.GEMINI_IMAGE_MOCK = noKeyEnv.mock;
globalThis.fetch = previousLocalizationFetch;
console.log("Localization tests passed: English re-localization from saved data, translated official evidence, no image resubmission, and no-key response.");
