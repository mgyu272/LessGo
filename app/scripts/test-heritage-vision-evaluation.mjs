import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildEvaluationSummary,
  classifyApiFailure,
  classifyPrediction,
  createEmptySummary,
  hasLivePermission,
  isVerifiedLabel,
  normalizeVisionPrediction,
  persistEvaluationRun,
  validateEvaluationDataset,
} from "./lib/heritage-vision-evaluation.js";

const valid = {
  imageId: "fixture-001", imagePath: "images/locally-added.jpg", spotId: "jeongneung", spotName: "정릉",
  groundTruthName: "정자각", groundTruthAliases: ["Jeongjagak"], groundTruthSubjectLevel: "facility",
  reviewer: "reviewer-1", reviewedAt: "2026-11-05", evidence: "Checked against an on-site sign and official record.", labelStatus: "verified",
  usagePermission: { status: "confirmed", permittedForGemini: true, reviewer: "permission-reviewer", reviewedAt: "2026-11-05", basis: "Photographer's written approval." },
  notes: null,
};
const unverified = { ...valid, imageId: "fixture-002", groundTruthName: null, groundTruthAliases: [], groundTruthSubjectLevel: null, reviewer: null, reviewedAt: null, evidence: null, labelStatus: "unverified", usagePermission: { status: "not_confirmed", permittedForGemini: false, reviewer: null, reviewedAt: null, basis: null } };

assert.deepEqual(validateEvaluationDataset({ schemaVersion: 1, images: [] }), []);
assert.deepEqual(validateEvaluationDataset({ schemaVersion: 1, images: [valid] }), []);
assert.ok(validateEvaluationDataset({ schemaVersion: 1, images: [{ ...valid, labelStatus: "verified", reviewer: null }] }).some((issue) => issue.includes("lacks a reviewed label")));
assert.ok(validateEvaluationDataset({ schemaVersion: 1, images: [{ ...valid, imagePath: "../private.jpg" }] }).some((issue) => issue.includes("safe relative path")));
assert.ok(validateEvaluationDataset({ schemaVersion: 1, images: [valid, { ...valid, imageId: "duplicate-path" }] }).some((issue) => issue.includes("imagePath is duplicated")));
assert.equal(isVerifiedLabel(valid), true);
assert.equal(hasLivePermission(valid), true);
assert.equal(isVerifiedLabel(unverified), false);
assert.equal(hasLivePermission(unverified), false);

const normalized = normalizeVisionPrediction({ candidateName: "Jeongjagak", objectType: "building", subjectLevel: "facility", visualFeatures: ["tiled roof"], identificationStatus: "identified", reason: "Visible structure." });
assert.deepEqual(classifyPrediction(valid, normalized, { officialAliases: ["정자각", "Jeongjagak"] }), { isCorrect: true, errorType: null, errorTypes: [], nameMatch: true, levelMatch: true });
assert.equal(classifyPrediction(valid, normalized).isCorrect, false, "an unregistered free-form alias does not count as correct");
assert.equal(classifyPrediction(valid, { ...normalized, candidateName: "정릉", subjectLevel: "place" }).errorType, "place_only");
assert.equal(classifyPrediction(valid, { ...normalized, candidateName: "의릉", subjectLevel: "place" }, { knownSpotNames: ["정릉", "의릉"] }).errorType, "wrong_place");
assert.ok(classifyPrediction(valid, { ...normalized, candidateName: "비각", identificationStatus: "identified" }).errorTypes.includes("overconfident_wrong"));
assert.equal(classifyPrediction(valid, { ...normalized, candidateName: "unknown", identificationStatus: "unknown", subjectLevel: "unknown" }).errorType, "identification_failure");
assert.equal(classifyPrediction(valid, { ...normalized, identificationStatus: "uncertain" }, { officialAliases: ["정자각", "Jeongjagak"] }).isCorrect, true, "uncertainty is never automatically correct; an exact reviewed name and level are still required");
assert.throws(() => normalizeVisionPrediction({ candidateName: "x", identificationStatus: "not-a-status" }), { code: "invalid_model_response" });

for (const [error, expected] of [
  [{ geminiStatus: 401 }, "authentication_error"], [{ geminiStatus: 403 }, "authentication_error"],
  [{ geminiStatus: 404 }, "model_error"], [{ geminiStatus: 429 }, "quota_or_rate_limit"],
  [{ geminiStatus: 503 }, "service_unavailable"], [{ code: "gemini_timeout" }, "timeout"],
  [{ code: "gemini_dns_error" }, "dns_error"], [{ code: "gemini_network_error" }, "network_error"],
  [new SyntaxError("bad json"), "invalid_response"],
]) assert.equal(classifyApiFailure(error).errorType, expected);

const good = { imageId: valid.imageId, apiStatus: "success", prediction: normalized, isCorrect: true, errorType: null };
const apiError = { imageId: "fixture-api-fail", apiStatus: "error", errorType: "service_unavailable" };
const unverifiedResult = { imageId: unverified.imageId, apiStatus: "success", prediction: normalized, isCorrect: true, errorType: null };
const summary = buildEvaluationSummary({ records: [valid, { ...valid, imageId: "fixture-api-fail" }, unverified], results: [good, apiError, unverifiedResult] });
assert.equal(summary.evaluatedCount, 1, "API errors and unverified labels are excluded from the accuracy denominator");
assert.equal(summary.overallAccuracy.denominator, 1);
assert.equal(summary.overallAccuracy.accuracyPercent, 100);
assert.equal(summary.apiFailureCount, 1);
assert.equal(summary.unverifiedLabelCount, 1);
assert.equal(createEmptySummary().overallAccuracy.accuracyPercent, null, "empty data has no fabricated percentage");
assert.equal(createEmptySummary().placeRecognitionAccuracy.accuracyPercent, null);

const tempRoot = path.resolve(".local", "heritage_vision_eval_4a", "test-temp");
await mkdir(tempRoot, { recursive: true });
const temp = await mkdtemp(path.join(tempRoot, "run-"));
try {
  await persistEvaluationRun({ directory: temp, metadata: { interrupted: false }, results: [good], summary, report: "partial run" });
  await persistEvaluationRun({ directory: temp, metadata: { interrupted: true }, results: [good, apiError], summary, report: "interrupted with prior results" });
  const saved = JSON.parse(await readFile(path.join(temp, "results.json"), "utf8"));
  assert.equal(saved.metadata.interrupted, true);
  assert.equal(saved.results.length, 2, "a stopped run preserves completed result rows");
  assert.equal(await readFile(path.join(temp, "report.md"), "utf8"), "interrupted with prior results");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("Heritage Vision evaluation self-test passed: empty/unverified datasets, verified labels, exact/alias/place-only/wrong-place results, uncertainty, API/JSON errors, denominators, and partial-result persistence. No image or Gemini request used.");
