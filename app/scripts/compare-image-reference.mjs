// Network-free integration exercise for baseline vs reference-assisted Gemini request shapes.
// It uses local sample bytes and a fake fetch handler; it never contacts Google.
import assert from "node:assert/strict";
import api from "../api/analyze-image.js";
import { askGeminiJSON } from "../api/_lib/gemini.js";
import {
  buildReferenceAssistedRequest,
  canSendReferencesToGemini,
  referenceLimits,
  selectLocalReferenceImages,
} from "../api/_lib/heritage-reference.js";

const spotId = process.argv[2] || "simujang";
const spotNames = { simujang: "심우장", jeongneung: "정릉", uiryeong: "의릉" };
const candidateHints = { simujang: "건물", jeongneung: "왕릉", uiryeong: "봉분" };
assert.ok(spotNames[spotId], `Unsupported test spotId: ${spotId}`);
const userImage = { mimeType: "image/png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") };
const baselineMock = {
  candidateName: `테스트 ${candidateHints[spotId]} 후보`, objectType: candidateHints[spotId], visualFeatures: ["테스트 데이터"],
  identificationStatus: "uncertain", reason: "테스트용 가짜 결과입니다.",
};
const assistedMock = {
  candidateName: `테스트 참고 ${candidateHints[spotId]}`, objectType: candidateHints[spotId], visualFeatures: ["테스트 데이터"],
  identificationStatus: "uncertain", reason: "테스트용 가짜 결과이며 정확도 검증이 아닙니다.",
};

const previousFetch = globalThis.fetch;
const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_MOCK: process.env.GEMINI_IMAGE_MOCK,
  GEMINI_IMAGE_REFERENCE_MODE: process.env.GEMINI_IMAGE_REFERENCE_MODE,
  GEMINI_IMAGE_REFERENCE_EXTERNAL_OK: process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK,
};
const requests = [];
let responseIndex = 0;
globalThis.fetch = async (url, options) => {
  const payload = JSON.parse(options.body);
  requests.push({ url: String(url), payload });
  const selected = responseIndex++ === 0 ? baselineMock : assistedMock;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(selected) }] } }] }) };
};

function makeResponse() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
}

try {
  process.env.GEMINI_API_KEY = "offline-test-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  delete process.env.GEMINI_IMAGE_MODEL;
  delete process.env.GEMINI_IMAGE_MOCK;
  process.env.GEMINI_IMAGE_REFERENCE_MODE = "1";
  process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = "1";

  const references = await selectLocalReferenceImages({ spotId, candidateName: candidateHints[spotId], objectType: candidateHints[spotId] });
  assert.ok(references.length >= 2 && references.length <= 3, `Expected 2–3 same-place refs, received ${references.length}`);
  assert.ok(references.every((ref) => ref.filenameCandidate.startsWith(spotNames[spotId])), "Cross-place reference leaked into selection");
  assert.ok(references.every((ref) => ref.bytes.length <= referenceLimits.perImageBytes), "Per-reference size limit exceeded");
  assert.ok(references.reduce((sum, ref) => sum + ref.bytes.length, 0) <= referenceLimits.totalBytes, "Aggregate reference size limit exceeded");
  assert.equal(await canSendReferencesToGemini(), false, "Unapproved 4-A source must block external reference transmission");

  // Exercise the actual API fallback with the mode enabled: only the user image is sent.
  const apiResponse = makeResponse();
  const pngBytes = Buffer.from(userImage.data, "base64");
  await api({ method: "POST", body: {
    spotId, spotName: spotNames[spotId], lang: "ko", mimeType: "image/png", imageBase64: pngBytes.toString("base64"),
  } }, apiResponse);
  assert.equal(apiResponse.statusCode, 200);
  assert.equal(requests.length, 1, "Rights gate should keep the API to one Gemini call");
  assert.equal(requests[0].payload.contents[0].parts.filter((part) => part.inline_data).length, 1);
  assert.deepEqual(apiResponse.body, { ...baselineMock, source: "gemini", testData: false, model: "gemini-3.5-flash-lite" });
  assert.equal(JSON.stringify(apiResponse.body).includes("filename"), false, "Reference metadata must not reach the client");

  // Exercise the secondary prompt/part layout against a fake fetch only.
  const request = buildReferenceAssistedRequest({
    spotId, spotName: spotNames[spotId], lang: "ko", baseline: baselineMock,
    userImage: { ...userImage, data: pngBytes.toString("base64") }, references,
  });
  const assisted = await askGeminiJSON({ ...request, images: request.images, model: "gemini-3.5-flash-lite" });
  const parts = requests[1].payload.contents[0].parts;
  const imageParts = parts.filter((part) => part.inline_data);
  const roleText = parts.filter((part) => part.text).map((part) => part.text).join("\n");
  assert.equal(imageParts.length, 1 + references.length);
  assert.match(roleText, /USER PHOTO/);
  assert.match(roleText, /SUPPORTING REFERENCE 1/);
  assert.match(roleText, /unverified filename candidate/i);
  assert.equal(assisted.identificationStatus, "uncertain");

  console.log(JSON.stringify({
    testMode: "offline_mock_only",
    externalNetworkRequests: 0,
    mockFetchCalls: requests.length,
    spotId,
    locallySelectedReferences: references.length,
    sameSpotOnly: true,
    apiFallback: "baseline only; 1 mock upstream request; response contains no reference metadata",
    assistedPromptMock: { imageCount: imageParts.length, result: assisted, testData: true },
    accuracyClaim: false,
  }, null, 2));
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
