import assert from "node:assert/strict";
import { verifyImageEvidence } from "../api/_lib/history-evidence.js";
import {
  buildExplanationPrompt,
  buildMockExplanation,
  classifyExplanationType,
  buildFallbackExplanation,
  explanationErrorResponse,
  generateHistoryExplanation,
} from "../api/_lib/history-explanation.js";

const places = [
  { spotId: "simujang", officialName: "심우장", officialType: "한옥", internalName: "한용운", internalType: "인물" },
  { spotId: "jeongneung", officialName: "정자각", officialType: "건축물", internalName: "Queen Sindeok", internalType: "queen" },
  { spotId: "uiryeong", officialName: "정자각", officialType: "건축물", internalName: "의릉", internalType: "왕릉" },
];

for (const place of places) {
  const official = await verifyImageEvidence({ spotId: place.spotId, candidateName: place.officialName, objectType: place.officialType, visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" });
  assert.equal(official.evidenceStatus, "supported", `${place.spotId}: expected supported official record`);
  assert.equal(classifyExplanationType({ evidence: official, identificationStatus: "identified" }), "grounded", `${place.spotId}: grounded`);

  const internal = await verifyImageEvidence({ spotId: place.spotId, candidateName: place.internalName, objectType: place.internalType, visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" });
  assert.equal(internal.evidenceStatus, "supported", `${place.spotId}: expected internal fallback`);
  assert.equal(internal.sourceLevel, "internal");
  assert.equal(classifyExplanationType({ evidence: internal, identificationStatus: "identified" }), "estimated", `${place.spotId}: internal must be estimated`);

  const unknown = await verifyImageEvidence({ spotId: place.spotId, candidateName: place.officialName, objectType: place.officialType, visualFeatures: ["기와지붕"], identificationStatus: "unknown", lang: "ko" });
  assert.equal(classifyExplanationType({ evidence: unknown, identificationStatus: "unknown" }), "estimated", `${place.spotId}: unknown`);

  const conflictName = place.spotId === "simujang" ? "정릉" : "심우장";
  const conflicting = await verifyImageEvidence({ spotId: place.spotId, candidateName: conflictName, objectType: "문화유산", visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" });
  assert.equal(conflicting.evidenceStatus, "conflicting", `${place.spotId}: conflicting evidence`);
  assert.equal(classifyExplanationType({ evidence: conflicting, identificationStatus: "identified" }), "estimated", `${place.spotId}: conflict must be estimated`);
}

const uncertainEvidence = await verifyImageEvidence({ spotId: "jeongneung", candidateName: "정자각", objectType: "건축물", visualFeatures: ["기와지붕"], identificationStatus: "uncertain", lang: "ko" });
assert.equal(classifyExplanationType({ evidence: uncertainEvidence, identificationStatus: "uncertain" }), "grounded");
const uncertainPrompt = buildExplanationPrompt({ type: "grounded", lang: "ko", candidateName: "정자각", objectType: "건축물", visualFeatures: [], identificationStatus: "uncertain", evidence: uncertainEvidence });
assert.match(uncertainPrompt.system, /uncertain/u);
assert.match(uncertainPrompt.system, /Do not identify the photo as the candidate/u);
assert.match(uncertainPrompt.system, /explain verified information about the related facility/u);

const simujangEvidence = await verifyImageEvidence({ spotId: "simujang", candidateName: "심우장", objectType: "한옥", visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" });
assert.ok(simujangEvidence.supportedFacts.some((fact) => fact.includes("생애를 마칠 때까지")), "Simujang source-backed life fact is included");
assert.ok(simujangEvidence.supportedFacts.some((fact) => fact.includes("동북향")), "Simujang orientation fact is included");
assert.ok(simujangEvidence.factSources.every((entry) => entry.sources.some((source) => source.sourceId && source.url?.startsWith("https://"))));

const jeongneungEvidence = await verifyImageEvidence({ spotId: "jeongneung", candidateName: "정자각", objectType: "건축물", visualFeatures: ["지붕"], identificationStatus: "identified", lang: "ko" });
assert.ok(jeongneungEvidence.supportedFacts.some((fact) => fact.includes("왕릉 제향")));
assert.ok(jeongneungEvidence.supportedFacts.some((fact) => fact.includes("1669년")));

const uireungStoneEvidence = await verifyImageEvidence({ spotId: "uiryeong", candidateName: "의릉 석물", objectType: "석물", visualFeatures: ["석상과 동물 형상의 조각"], identificationStatus: "identified", lang: "en" });
assert.ok(uireungStoneEvidence.supportedFacts.some((fact) => fact.includes("stone tiger") || fact.includes("석호")));
const stonePrompt = buildExplanationPrompt({ type: "grounded", lang: "en", candidateName: "Uireung stone sculptures", objectType: "stonework", visualFeatures: ["animal-shaped stone sculpture"], identificationStatus: "identified", evidence: uireungStoneEvidence });
assert.match(stonePrompt.user, /verifiedFacts/u);
assert.match(stonePrompt.user, /observedVisualFeatures/u);
assert.doesNotMatch(stonePrompt.user, /The photo shows a stone tiger/u);

const unsupportedPrompt = buildExplanationPrompt({
  type: "estimated", lang: "ko", candidateName: "unverified", objectType: "unknown", visualFeatures: ["어두운 돌 표면"],
  identificationStatus: "unknown", evidence: { evidenceStatus: "insufficient", sourceLevel: "none", supportedFacts: ["가짜 연도 1400년"], factSources: [] },
});
assert.doesNotMatch(unsupportedPrompt.user, /가짜 연도/u);
assert.doesNotMatch(unsupportedPrompt.user, /1400년/u);
assert.match(unsupportedPrompt.system, /Do not assert an object's identity, historical role, date, person, event/u);
assert.match(unsupportedPrompt.system, /Never mix aiContext into text/u);
assert.equal(JSON.parse(unsupportedPrompt.user).allowGeneralContext, false);

const royalTombPrompt = buildExplanationPrompt({
  type: "estimated", lang: "en", candidateName: "unverified", objectType: "royal tomb", visualFeatures: ["stone mound"],
  identificationStatus: "uncertain", evidence: { evidenceStatus: "insufficient", sourceLevel: "none", factSources: [] },
});
assert.equal(JSON.parse(royalTombPrompt.user).allowGeneralContext, true);
assert.match(royalTombPrompt.system, /aiContext is AI-generated and not officially verified/u);

const previousFetch = globalThis.fetch;
const previousKey = process.env.GEMINI_API_KEY;
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(init.body);
  const prompt = request.contents[0].parts[0].text;
  const isEstimated = prompt.includes("visual_estimate_with_separate_general_context");
  if (!isEstimated) assert.match(prompt, /verifiedFacts/u);
  const response = isEstimated
    ? { title: "Visual details", text: "The photo analysis noted a dark stone surface. You can compare its visible texture and shape with the structure nearby.", aiContext: ["In general, royal tomb landscapes can be explored through their arrangement of visible spaces."] }
    : { title: "Official record", text: "의릉의 정자각은 공식 연구 자료에서 공간축의 시설로 설명됩니다. 궁능유적본부 자료는 정자각이 왕릉 제향 공간이라고 안내합니다. 정릉 자료에는 1669년 능 시설 정비 기록이 있습니다. 이런 기록은 왕릉 공간의 역할을 이해하는 데 도움이 됩니다. 현장에서는 시설의 배치와 지붕 형태를 자료와 함께 살펴볼 수 있어요.", aiContext: ["왕릉을 살펴볼 때는 건축물과 주변 공간이 어떤 순서로 이어지는지 비교해 볼 수 있습니다."] };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) };
};
try {
  process.env.GEMINI_API_KEY = "local-test-key";
  const explanation = await generateHistoryExplanation({
    evidence: await verifyImageEvidence({ spotId: "uiryeong", candidateName: "정자각", objectType: "건축물", visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" }),
    candidateName: "정자각", objectType: "건축물", visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko",
  });
  assert.equal(explanation.type, "grounded");
  assert.equal(explanation.language, "ko");
  assert.ok(explanation.sources.length >= 2);
  assert.ok(explanation.sources[0].supportsFacts.length > 0);
  assert.ok(explanation.sources[0].sourceIds.length > 0);
  assert.equal(explanation.aiContext.length, 1);
  assert.equal(explanation.aiContextVerification, "unverified_general_ai_context");
  assert.equal(explanation.aiContextLabel, "AI 일반 역사 맥락 · 공식 자료로 검증되지 않음");
  assert.equal(explanation.testData, undefined);

  const estimatedEvidence = await verifyImageEvidence({ spotId: "jeongneung", candidateName: "Queen Sindeok", objectType: "queen", visualFeatures: ["dark stone surface"], identificationStatus: "identified", lang: "en" });
  const estimated = await generateHistoryExplanation({
    evidence: estimatedEvidence, candidateName: "Queen Sindeok", objectType: "queen", visualFeatures: ["dark stone surface"], identificationStatus: "identified", lang: "en",
  });
  assert.equal(estimated.type, "estimated");
  assert.equal(estimated.language, "en");
  assert.deepEqual(estimated.sources, []);
  assert.deepEqual(estimated.aiContext, [], "unknown or conflicting candidates do not receive general history context");
  assert.match(estimated.disclaimer, /not a verified identification/u);

  const generalContextEvidence = await verifyImageEvidence({ spotId: "jeongneung", candidateName: "unverified structure", objectType: "royal tomb", visualFeatures: ["stone mound"], identificationStatus: "uncertain", lang: "en" });
  const generalContext = await generateHistoryExplanation({
    evidence: generalContextEvidence, candidateName: "unverified structure", objectType: "royal tomb", visualFeatures: ["stone mound"], identificationStatus: "uncertain", lang: "en",
  });
  assert.equal(generalContext.type, "estimated");
  assert.equal(generalContext.aiContext.length, 1);
  assert.equal(generalContext.aiContextLabel, "General AI historical context · not verified by official sources");
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
}

// A failed optional Gemini response must retain only verified, cited records.
const fallbackOfficial = buildFallbackExplanation({ evidence: jeongneungEvidence, visualFeatures: ["기와지붕"], identificationStatus: "identified", lang: "ko" });
assert.equal(fallbackOfficial.type, "grounded");
assert.equal(fallbackOfficial.fallback, true);
assert.ok(fallbackOfficial.text.includes("왕릉 제향"));
assert.ok(fallbackOfficial.sources.some((source) => source.url?.startsWith("https://")));
assert.deepEqual(fallbackOfficial.aiContext, []);
const fallbackVisual = buildFallbackExplanation({ evidence: { evidenceStatus: "insufficient", sourceLevel: "none", factSources: [] }, visualFeatures: ["지붕"], identificationStatus: "uncertain", lang: "ko" });
assert.equal(fallbackVisual.type, "estimated");
assert.deepEqual(fallbackVisual.sources, []);
assert.ok(!fallbackVisual.text.includes("왕릉 제향"));

const testExplanation = buildMockExplanation({ lang: "en", visualFeatures: ["gray stone surface"] });
assert.equal(testExplanation.type, "estimated");
assert.equal(testExplanation.testData, true);
assert.match(testExplanation.disclaimer, /Test data/u);
assert.deepEqual(testExplanation.sources, []);
assert.equal(explanationErrorResponse({ name: "AbortError" }, "en").code, "explanation_timeout");

console.log("History explanation tests passed: 3 spots × grounded/estimated/unknown/conflicting, uncertain identity guard, source linking, English mock label, and generation error mapping.");
