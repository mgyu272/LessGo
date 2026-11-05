import assert from "node:assert/strict";
import analyzeImage from "../api/analyze-image.js";
import {
  applyReferenceComparison,
  buildReferenceAssistedRequest,
  canSendReferencesToGemini,
  referenceLimits,
  selectLocalReferenceImages,
} from "../api/_lib/heritage-reference.js";
import { getOfficialVisualCandidates } from "../api/_lib/history-evidence.js";

const single = await selectLocalReferenceImages({
  spotId: "jeongneung", spotName: "정릉", candidateName: "정자각", objectType: "정자각", subjectLevel: "facility", maxCount: 1,
});
assert.equal(referenceLimits.min, 1);
assert.equal(single.length, 1, "one usable reference is sufficient for local selection");
assert.equal(single[0].objectNameCandidate, "정자각", "specific facility candidate ranks first");
assert.equal(single[0].verificationStatus, "unverified_filename_only");
assert.ok(Buffer.isBuffer(single[0].bytes));

const multiple = await selectLocalReferenceImages({
  spotId: "jeongneung", spotName: "정릉", candidateName: "정자각", objectType: "정자각", subjectLevel: "facility", maxCount: 3,
});
assert.ok(multiple.length > 1 && multiple.length <= 3);
assert.ok(multiple.every((photo) => photo.id.startsWith("hlref-jeongneung-")), "selection never crosses spot IDs");
assert.deepEqual(await selectLocalReferenceImages({ spotId: "simujang", candidateName: "홍살문", objectType: "홍살문" }), []);
assert.deepEqual(await selectLocalReferenceImages({ spotId: "jeongneung", candidateName: "unknown object", objectType: "unmapped" }), []);

const officialCandidates = await getOfficialVisualCandidates("jeongneung");
const baseline = { candidateName: "건축물", objectType: "건축물", subjectLevel: "general", visualFeatures: ["기와지붕"], identificationStatus: "uncertain", reason: "형태가 분명하지 않음" };
const assisted = { candidateName: "정자각", objectType: "정자각", subjectLevel: "facility", visualFeatures: ["정면 지붕", "기둥 배열"], identificationStatus: "identified", reason: "참고 사진과 구조가 비슷함" };
const matched = applyReferenceComparison({ baseline, assisted, status: "matched", visualEvidence: ["지붕 윤곽", "기둥 간격"], officialCandidates });
assert.equal(matched.comparison.status, "matched");
assert.equal(matched.comparison.candidateChanged, true);
assert.equal(matched.result.candidateName, "정자각");
assert.equal(matched.result.identificationStatus, "uncertain", "a changed candidate never becomes confirmed by reference similarity");

const unsupportedChange = applyReferenceComparison({ baseline, assisted: { ...assisted, candidateName: "다른 장소의 시설" }, status: "matched", officialCandidates });
assert.equal(unsupportedChange.result.candidateName, baseline.candidateName, "candidate changes must be in the official place-scoped vocabulary");
assert.equal(unsupportedChange.comparison.candidateChanged, false);

for (const status of ["mismatched", "inconclusive"]) {
  const conservative = applyReferenceComparison({ baseline, assisted, status, officialCandidates });
  assert.deepEqual(conservative.result, baseline, `${status} preserves the baseline analysis`);
  assert.equal(conservative.comparison.status, status);
}

const request = buildReferenceAssistedRequest({
  spotName: "정릉", spotId: "jeongneung", lang: "ko", baseline,
  userImage: { mimeType: "image/jpeg", data: "dXNlci1waG90bw==" },
  references: [{ ...single[0], bytes: Buffer.from("reference") }], officialCandidates,
});
assert.match(request.user, /USER PHOTO/u);
assert.match(request.user, /SUPPORTING REFERENCE/u);
assert.match(request.system, /unverified filename-derived labels/u);
assert.equal(request.images.length, 2);
assert.match(request.images[1].label, /UNVERIFIED FILENAME\/METADATA CANDIDATES/u);

const envBefore = {
  key: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
  mode: process.env.GEMINI_IMAGE_REFERENCE_MODE,
  external: process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK,
  mock: process.env.GEMINI_IMAGE_MOCK,
};
let outboundCalls = 0;
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => {
  outboundCalls++;
  const vision = { candidateName: "정자각", objectType: "건축물", subjectLevel: "facility", visualFeatures: ["기와지붕"], identificationStatus: "identified", reason: "지붕과 기둥이 보임" };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(vision) }] } }] }) };
};
try {
  process.env.GEMINI_API_KEY = "offline-reference-test-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_IMAGE_REFERENCE_MODE = "1";
  process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = "1";
  delete process.env.GEMINI_IMAGE_MOCK;
  assert.equal(await canSendReferencesToGemini(), false, "unresolved source rights remain a hard block even when flags are enabled");
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
  const imageBase64 = Buffer.from([0xff, 0xd8, 0xff, 0]).toString("base64");
  await analyzeImage({ method: "POST", body: { spotId: "jeongneung", spotName: "정릉", lang: "ko", mimeType: "image/jpeg", imageBase64, explanationMode: "deferred" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(outboundCalls, 1, "deferred flow performs baseline Vision only when reference rights are not confirmed");
  assert.equal(response.body.referenceComparison.status, "not_compared");
  assert.equal(response.body.referenceComparison.reasonCode, "external_use_not_authorized");
  assert.equal(response.body.referenceComparison.referenceCount, 0, "unauthorized local candidates are not reported as used");
  assert.ok(!JSON.stringify(response.body).includes("hlref-"), "private manifest IDs and file paths are not returned");
} finally {
  globalThis.fetch = fetchBefore;
  if (envBefore.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = envBefore.key;
  if (envBefore.model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = envBefore.model;
  if (envBefore.mode === undefined) delete process.env.GEMINI_IMAGE_REFERENCE_MODE; else process.env.GEMINI_IMAGE_REFERENCE_MODE = envBefore.mode;
  if (envBefore.external === undefined) delete process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK; else process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = envBefore.external;
  if (envBefore.mock === undefined) delete process.env.GEMINI_IMAGE_MOCK; else process.env.GEMINI_IMAGE_MOCK = envBefore.mock;
  globalThis.fetch = fetchBefore;
}

console.log("Heritage reference comparison tests passed: one/multiple selections, spot scope, unknown candidates, cautious result merge, deferred flow, permission gate, and no reference egress.");
