import assert from "node:assert/strict";
import { verifyImageEvidence } from "../api/_lib/history-evidence.js";
import { classifyExplanationType, buildExplanationPrompt } from "../api/_lib/history-explanation.js";

const verify = (input) => verifyImageEvidence({ lang: "ko", visualFeatures: ["기와지붕", "목조 기둥"], ...input });

// Vision's broad visual label must remain compatible with the official Simujang record.
const simujangTraditionalHouse = await verify({ spotId: "simujang", candidateName: "심우장", objectType: "전통 가옥", identificationStatus: "identified" });
assert.equal(simujangTraditionalHouse.evidenceStatus, "supported");
assert.equal(simujangTraditionalHouse.sourceLevel, "official");
assert.equal(simujangTraditionalHouse.matchedObjectName, "심우장");
assert.equal(simujangTraditionalHouse.supportedFacts.length, 3);
assert.ok(simujangTraditionalHouse.sources.length >= 2);
assert.ok(simujangTraditionalHouse.sources.every((source) => source.url?.startsWith("https://")));
assert.ok(simujangTraditionalHouse.factSources.every((fact) => fact.sources.length > 0));
assert.equal(classifyExplanationType({ evidence: simujangTraditionalHouse, identificationStatus: "identified" }), "grounded");

// A type from a clearly incompatible family remains a real conflict.
for (const objectType of ["사람", "음식", "나무", "자동차"]) {
  const irrelevant = await verify({ spotId: "simujang", candidateName: "심우장", objectType, identificationStatus: "identified" });
  assert.equal(irrelevant.evidenceStatus, "conflicting", `${objectType} must not be matched to a house`);
  assert.deepEqual(irrelevant.supportedFacts, []);
  assert.equal(classifyExplanationType({ evidence: irrelevant, identificationStatus: "identified" }), "estimated");
}
const unmappedType = await verify({ spotId: "simujang", candidateName: "심우장", objectType: "unmapped visual label", identificationStatus: "identified" });
assert.equal(unmappedType.evidenceStatus, "supported", "an unmapped type alone is not asserted to be a contradiction");
assert.ok(unmappedType.limitations.some((line) => line.includes("직접 비교할 수 없어")));

// Same facility names remain scoped to each place's own official entry.
for (const spotId of ["jeongneung", "uiryeong"]) {
  const jeongjagak = await verify({ spotId, candidateName: "정자각", objectType: "전통 건축물", identificationStatus: "identified" });
  assert.equal(jeongjagak.evidenceStatus, "supported", `${spotId} should use its own Jeongjagak record`);
  assert.equal(jeongjagak.sourceLevel, "official");
}
const uiryeungStone = await verify({ spotId: "uiryeong", candidateName: "의릉 석물", objectType: "석물", identificationStatus: "identified" });
assert.equal(uiryeungStone.evidenceStatus, "supported");
assert.equal(uiryeungStone.sourceLevel, "official");

// Cross-place names, unknown images and unsupported names never acquire facts.
const wrongPlace = await verify({ spotId: "simujang", candidateName: "정릉", objectType: "왕릉", identificationStatus: "identified" });
assert.equal(wrongPlace.evidenceStatus, "conflicting");
assert.deepEqual(wrongPlace.supportedFacts, []);
const unknown = await verify({ spotId: "simujang", candidateName: "심우장", objectType: "전통 가옥", identificationStatus: "unknown" });
assert.equal(unknown.evidenceStatus, "insufficient");
assert.deepEqual(unknown.supportedFacts, []);
const foodCandidate = await verify({ spotId: "simujang", candidateName: "김밥", objectType: "음식", identificationStatus: "identified" });
assert.equal(foodCandidate.evidenceStatus, "insufficient");
assert.deepEqual(foodCandidate.supportedFacts, []);

// Unsupported data is not passed into the historical generation prompt.
const estimatedPrompt = buildExplanationPrompt({
  type: "estimated", lang: "ko", candidateName: "김밥", objectType: "음식", visualFeatures: ["노란색 둥근 형태"],
  identificationStatus: "identified", evidence: { evidenceStatus: "insufficient", supportedFacts: ["가짜 역사 사실"], factSources: [] },
});
assert.doesNotMatch(estimatedPrompt.user, /가짜 역사 사실/u);
assert.match(estimatedPrompt.system, /Do not assert an object name, historical role, date, person, event/u);

// Uncertain identity may use official place facts, but must remain explicitly uncertain.
const uncertain = await verify({ spotId: "simujang", candidateName: "심우장", objectType: "전통 가옥", identificationStatus: "uncertain" });
assert.equal(uncertain.evidenceStatus, "supported");
assert.equal(classifyExplanationType({ evidence: uncertain, identificationStatus: "uncertain" }), "grounded");
assert.ok(uncertain.limitations.some((line) => line.includes("uncertain")));

console.log("History Lens v8 checks passed: semantic type compatibility, official Simujang fact/source mapping, irrelevant-photo rejection, spot-scoped records, uncertainty guard, and no unsupported historical facts.");
